# Switching question-image storage from Floci to AWS S3

The API talks to storage through Bun's built-in S3 client, configured entirely
by env vars — there is **no code change** involved. Locally those vars default
to the Floci emulator (`http://localhost:4566`, bucket `wcl-images`, dummy
creds). Switching to AWS is: create the bucket, create credentials, point the
env vars at AWS, migrate any existing objects, verify.

Example region below is `ap-south-1` (Mumbai); substitute your own. Example
bucket name is `wcl-images-prod` — bucket names are globally unique, pick your
own.

---

## 1. Create the bucket

```bash
aws s3api create-bucket \
  --bucket wcl-images-prod \
  --region ap-south-1 \
  --create-bucket-configuration LocationConstraint=ap-south-1
```

## 2. Make images publicly readable

Candidates' Electron clients and the admin browser load images with plain
`<img src>` GETs — the objects must be publicly readable. Uploads are **not**
public; they go through `POST /admin/upload` on the API server.

Allow public bucket policies (Block Public Access is on by default):

```bash
aws s3api put-public-access-block \
  --bucket wcl-images-prod \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false
```

Then attach a read-only policy scoped to the `q/` prefix (the only prefix the
API writes):

```bash
aws s3api put-bucket-policy --bucket wcl-images-prod --policy '{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadQuestionImages",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::wcl-images-prod/q/*"
  }]
}'
```

> Alternative: put CloudFront in front of the bucket and keep the bucket
> private (Origin Access Control). Then `S3_PUBLIC_URL` in step 4 is the
> CloudFront domain instead. Not required for a single exam event.

No CORS configuration is needed: `<img>` tags are exempt from CORS, and
uploads come from the API server, not the browser.

## 3. Create credentials for the API

Create an IAM user that can only write into `q/*` of this bucket:

```bash
aws iam create-user --user-name wcl-api-uploader
aws iam put-user-policy --user-name wcl-api-uploader --policy-name wcl-image-upload --policy-document '{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "s3:PutObject",
    "Resource": "arn:aws:s3:::wcl-images-prod/q/*"
  }]
}'
aws iam create-access-key --user-name wcl-api-uploader
```

Note the `AccessKeyId` / `SecretAccessKey` from the last command. Never commit
them.

## 4. Point the API at AWS

In `app/api/.env` replace the Floci values:

```dotenv
S3_ENDPOINT=https://s3.ap-south-1.amazonaws.com
S3_BUCKET=wcl-images-prod
S3_ACCESS_KEY_ID=<AccessKeyId from step 3>
S3_SECRET_ACCESS_KEY=<SecretAccessKey from step 3>
# Public base URL used to build the image URLs stored on questions.
# Without CloudFront, use the bucket's virtual-hosted style URL:
S3_PUBLIC_URL=https://wcl-images-prod.s3.ap-south-1.amazonaws.com
# With CloudFront: S3_PUBLIC_URL=https://dXXXXXXXXXXXX.cloudfront.net
```

Restart the API. From this moment every new upload lands in AWS and new
questions get AWS URLs.

## 5. Migrate objects uploaded while on Floci (skip if none)

Copy everything out of the emulator and up to AWS. Floci accepts any
credentials, so a dummy profile works for the download half:

```bash
# Pull from Floci (dummy creds satisfy the CLI)
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  aws --endpoint-url http://localhost:4566 s3 sync s3://wcl-images ./wcl-images-export

# Push to AWS (real creds/profile)
aws s3 sync ./wcl-images-export s3://wcl-images-prod
```

Existing questions still store Floci URLs in the database. Rewrite the prefix
(adjust the target to your `S3_PUBLIC_URL`):

```sql
UPDATE questions
SET image_url = replace(
  image_url,
  'http://localhost:4566/wcl-images',
  'https://wcl-images-prod.s3.ap-south-1.amazonaws.com'
)
WHERE image_url LIKE 'http://localhost:4566/wcl-images/%';
```

Then flush the cached question bank so manifests pick up the new URLs
immediately (otherwise it self-heals when the 600 s TTL expires or on the next
question upsert):

```bash
docker exec wcl-redis redis-cli --scan --pattern 'bank:*' | \
  xargs -r docker exec wcl-redis redis-cli del
```

## 6. Verify

1. `curl -I <any migrated image URL>` → `200` with an `image/*` content type.
2. Admin panel → Questions → attach a new image → the returned URL should be
   an AWS one and the preview should render.
3. Electron client → log in, begin the exam → image questions render (the
   client CSP already allows any `https:` image source).
4. Check the API audit log for the `image-upload` entry of the test upload.

## Rolling back

Set the four `S3_*` vars (and `S3_PUBLIC_URL`) back to the Floci values in
`app/api/.env.example`, restart the API, and reverse the SQL rewrite if any
questions were saved with AWS URLs in the meantime.
