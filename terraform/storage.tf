# S3 bucket for question images, served with public read (the app links image
# URLs directly). The API uploads with a dedicated least-privilege IAM user.

resource "aws_s3_bucket" "images" {
  bucket = "wcl-images"
  tags   = merge(local.tags, { Name = "wcl-images" })
}

# Public read requires the account-level block to be off for this bucket.
resource "aws_s3_bucket_public_access_block" "images" {
  bucket                  = aws_s3_bucket.images.id
  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "images_public_read" {
  bucket = aws_s3_bucket.images.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PublicRead"
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.images.arn}/*"
    }]
  })

  # The policy needs public policies to be permitted first.
  depends_on = [aws_s3_bucket_public_access_block.images]
}

# Least-privilege uploader for the API. Create an access key here and put it in
# .env.prod.backend (S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY).
resource "aws_iam_user" "uploader" {
  name = "wcl-api-uploader"
  tags = local.tags
}

resource "aws_iam_user_policy" "uploader" {
  name = "wcl-image-upload"
  user = aws_iam_user.uploader.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "s3:PutObject"
      Resource = "${aws_s3_bucket.images.arn}/*"
    }]
  })
}

resource "aws_iam_access_key" "uploader" {
  user = aws_iam_user.uploader.name
}
