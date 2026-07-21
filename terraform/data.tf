# The app runs in the account's default VPC and its per-AZ default subnets,
# exactly as the original CLI build did. These data sources resolve them so
# the config is not pinned to hard-coded VPC or subnet IDs.

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

# Latest Ubuntu 24.04 LTS (amd64, gp3) published to SSM by Canonical. The same
# parameter the CLI build read; it advances over time, so instances ignore AMI
# drift (see lifecycle blocks in compute.tf) to avoid surprise replacement.
data "aws_ssm_parameter" "ubuntu_2404" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

# The hosted zone is assumed to already exist (domain registered and delegated).
data "aws_route53_zone" "main" {
  name         = "${var.root_domain}."
  private_zone = false
}
