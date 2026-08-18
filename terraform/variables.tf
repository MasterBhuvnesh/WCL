variable "region" {
  description = "AWS region for every resource."
  type        = string
  default     = "ap-south-1"
}

variable "root_domain" {
  description = "Apex domain. Its Route53 hosted zone must already exist."
  type        = string
  default     = "rbuexam.in"
}

variable "images_bucket" {
  description = <<-EOT
    S3 bucket for question images. Bucket names are globally unique across all
    of AWS, so a rebuild in a different account may need a different name here.
  EOT
  type        = string
  default     = "wcl-images"
}

variable "rds_master_username" {
  description = "Postgres master user for the wcl-db instance."
  type        = string
  default     = "postgres"
}

variable "rds_master_password" {
  description = "Postgres master password. Set in terraform.tfvars, never commit it."
  type        = string
  sensitive   = true
}

variable "backend_instance_type" {
  description = "EC2 type for the API instance."
  type        = string
  default     = "t3.medium"
}

variable "frontend_instance_type" {
  description = "EC2 type for the admin + hall-ticket instance."
  type        = string
  default     = "t3.small"
}

variable "backend_public_key" {
  description = <<-EOT
    SSH public key for the wcl-backend key pair. Derive from the existing
    private key with: ssh-keygen -y -f secret/wcl-backend.pem
  EOT
  type        = string
}

variable "frontend_public_key" {
  description = <<-EOT
    SSH public key for the wcl (frontend) key pair. Derive from the existing
    private key with: ssh-keygen -y -f secret/wcl-frontend.pem
  EOT
  type        = string
}

locals {
  tags = {
    Project   = "WCL"
    ManagedBy = "Terraform"
  }
}
