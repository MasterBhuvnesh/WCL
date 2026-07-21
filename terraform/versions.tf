terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # State is local by default (terraform.tfstate, gitignored). To share state
  # across machines, uncomment and point at an S3 bucket you own:
  #
  # backend "s3" {
  #   bucket = "wcl-tfstate"
  #   key    = "wcl/terraform.tfstate"
  #   region = "ap-south-1"
  # }
}

provider "aws" {
  region = var.region
}
