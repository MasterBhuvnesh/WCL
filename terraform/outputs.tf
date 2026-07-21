output "alb_dns_name" {
  description = "ALB DNS name (the alias target for every hostname)."
  value       = aws_lb.main.dns_name
}

output "backend_instance_id" {
  description = "API instance id (for SSH via Instance Connect and target health)."
  value       = aws_instance.backend.id
}

output "frontend_instance_id" {
  description = "Admin/hall-ticket instance id."
  value       = aws_instance.frontend.id
}

output "instance_connect_endpoint_id" {
  description = "EC2 Instance Connect Endpoint id for SSH tunnels."
  value       = aws_ec2_instance_connect_endpoint.main.id
}

output "rds_endpoint" {
  description = "Postgres endpoint (host:port) for DATABASE_URL."
  value       = aws_db_instance.postgres.endpoint
}

output "redis_endpoint" {
  description = "Redis primary endpoint for REDIS_URL."
  value       = "${aws_elasticache_cluster.redis.cache_nodes[0].address}:${aws_elasticache_cluster.redis.cache_nodes[0].port}"
}

output "images_bucket" {
  description = "S3 bucket for question images."
  value       = aws_s3_bucket.images.bucket
}

output "uploader_access_key_id" {
  description = "Access key id for the wcl-api-uploader IAM user."
  value       = aws_iam_access_key.uploader.id
}

output "uploader_secret_access_key" {
  description = "Secret access key for the uploader. Copy into .env.prod.backend."
  value       = aws_iam_access_key.uploader.secret
  sensitive   = true
}
