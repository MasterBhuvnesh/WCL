# Managed Postgres (RDS) and Redis (ElastiCache). Both sit behind wcl-sg and
# are reachable only from the app instances or through an SSH tunnel.

resource "aws_db_instance" "postgres" {
  identifier = "wcl-db"
  engine     = "postgres"
  # Pinned to the major version the live instance ran (parameter group
  # default.postgres18). Unpinned, a rebuild picks whatever AWS defaults to at
  # the time, which can move the database out from under the Drizzle migrations.
  engine_version = "18"
  instance_class = "db.t4g.micro"

  allocated_storage = 20
  storage_type      = "gp2"

  username = var.rds_master_username
  password = var.rds_master_password

  vpc_security_group_ids = [aws_security_group.data.id]

  # Created publicly accessible during setup; the security group is what keeps
  # it private (no public ingress). Kept true to match the live instance.
  publicly_accessible = true

  backup_retention_period = 7
  skip_final_snapshot     = true
  apply_immediately       = true

  tags = merge(local.tags, { Name = "wcl-db" })
}

resource "aws_elasticache_subnet_group" "redis" {
  name       = "wcl-subnet-group"
  subnet_ids = data.aws_subnets.default.ids
  tags       = local.tags
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id = "wcl-redis"
  engine     = "redis"
  # The live cluster ran 7.1.0; pin the major.minor line for the same reason
  # the database version is pinned.
  engine_version     = "7.1"
  node_type          = "cache.t4g.micro"
  num_cache_nodes    = 1
  subnet_group_name  = aws_elasticache_subnet_group.redis.name
  security_group_ids = [aws_security_group.data.id]
  tags               = merge(local.tags, { Name = "wcl-redis" })
}
