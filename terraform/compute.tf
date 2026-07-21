# Two EC2 instances: the API box and the admin/hall-ticket box. Both run
# Ubuntu 24.04 with Docker installed by user-data. Deploy artifacts (compose
# file + .env) are shipped separately; images ship via Docker Hub + watchtower.

resource "aws_key_pair" "backend" {
  key_name   = "wcl-backend"
  public_key = var.backend_public_key
  tags       = local.tags
}

resource "aws_key_pair" "frontend" {
  key_name   = "wcl"
  public_key = var.frontend_public_key
  tags       = local.tags
}

resource "aws_instance" "backend" {
  ami                    = data.aws_ssm_parameter.ubuntu_2404.value
  instance_type          = var.backend_instance_type
  key_name               = aws_key_pair.backend.key_name
  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.backend_ec2.id]
  user_data              = file("${path.module}/user-data.sh")
  tags                   = merge(local.tags, { Name = "wcl-backend" })

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
  }

  # Canonical advances the "current" AMI over time; do not replace a live box
  # just because a newer image was published.
  lifecycle {
    ignore_changes = [ami]
  }
}

resource "aws_instance" "frontend" {
  ami                    = data.aws_ssm_parameter.ubuntu_2404.value
  instance_type          = var.frontend_instance_type
  key_name               = aws_key_pair.frontend.key_name
  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.frontend_ec2.id]
  user_data              = file("${path.module}/user-data.sh")
  tags                   = merge(local.tags, { Name = "wcl-frontend" })

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
  }

  lifecycle {
    ignore_changes = [ami]
  }
}
