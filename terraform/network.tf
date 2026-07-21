# Security groups and the EC2 Instance Connect Endpoint.
#
# Traffic model:
#   internet -> ALB (80/443)          : wcl-frontend-alb
#   ALB      -> frontend EC2 (5000/1) : wcl-frontend-ec2
#   ALB      -> backend  EC2 (4000/3000): wcl-backend-ec2
#   ICE      -> EC2 (22)              : reuses the ALB SG as its source group
#   EC2      -> RDS (5432) / Redis (6379): wcl-sg
# Nothing but the ALB is reachable from the internet.

# --- Public ALB (also the source group for the Instance Connect Endpoint) ---
resource "aws_security_group" "alb" {
  name        = "wcl-frontend-alb"
  description = "Public 80/443 for the shared ALB; reused by the Instance Connect Endpoint"
  vpc_id      = data.aws_vpc.default.id
  tags        = merge(local.tags, { Name = "wcl-frontend-alb" })

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# --- Frontend EC2 (admin 5000, hall-ticket 5001) ---
resource "aws_security_group" "frontend_ec2" {
  name        = "wcl-frontend-ec2"
  description = "App ports 5000/5001 and SSH, only from the ALB / Instance Connect SG"
  vpc_id      = data.aws_vpc.default.id
  tags        = merge(local.tags, { Name = "wcl-frontend-ec2" })

  ingress {
    description     = "Admin panel"
    from_port       = 5000
    to_port         = 5000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  ingress {
    description     = "Hall-ticket portal"
    from_port       = 5001
    to_port         = 5001
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  ingress {
    description     = "SSH via Instance Connect Endpoint"
    from_port       = 22
    to_port         = 22
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# --- Backend EC2 (API 4000, Grafana 3000) ---
resource "aws_security_group" "backend_ec2" {
  name        = "wcl-backend-ec2"
  description = "API 4000, Grafana 3000 and SSH, only from the ALB / Instance Connect SG"
  vpc_id      = data.aws_vpc.default.id
  tags        = merge(local.tags, { Name = "wcl-backend-ec2" })

  ingress {
    description     = "API"
    from_port       = 4000
    to_port         = 4000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  ingress {
    description     = "Grafana"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  ingress {
    description     = "SSH via Instance Connect Endpoint"
    from_port       = 22
    to_port         = 22
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# --- Data stores (RDS + ElastiCache), reachable only from the app instances ---
resource "aws_security_group" "data" {
  name        = "wcl-sg"
  description = "Postgres and Redis, only from the WCL app instances"
  vpc_id      = data.aws_vpc.default.id
  tags        = merge(local.tags, { Name = "wcl-sg" })

  ingress {
    description     = "Postgres from app instances"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.backend_ec2.id, aws_security_group.frontend_ec2.id]
  }

  ingress {
    description     = "Redis from the API instance"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.backend_ec2.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# SSH over 443 for networks that block port 22. Uses the ALB security group,
# so the "SSH from ALB SG" rules on the instances also admit this endpoint.
resource "aws_ec2_instance_connect_endpoint" "main" {
  subnet_id          = data.aws_subnets.default.ids[0]
  security_group_ids = [aws_security_group.alb.id]
  tags               = merge(local.tags, { Name = "wcl-ice" })
}
