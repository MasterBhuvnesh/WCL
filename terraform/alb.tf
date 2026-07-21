# One internet-facing ALB terminates TLS and routes by hostname to four target
# groups across the two instances:
#
#   rbuexam.in          -> wcl-hallticket (frontend :5001)  [listener default]
#   admin.rbuexam.in    -> wcl-admin      (frontend :5000)  [rule 10]
#   api.rbuexam.in      -> wcl-api        (backend  :4000)  [rule 20]
#   grafana.rbuexam.in  -> wcl-grafana    (backend  :3000)  [rule 30]

resource "aws_lb" "main" {
  name               = "wcl-frontend"
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = data.aws_subnets.default.ids
  tags               = merge(local.tags, { Name = "wcl-frontend" })
}

# --- Target groups ---
resource "aws_lb_target_group" "hallticket" {
  name        = "wcl-hallticket"
  port        = 5001
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.default.id
  target_type = "instance"
  tags        = local.tags
}

resource "aws_lb_target_group" "admin" {
  name        = "wcl-admin"
  port        = 5000
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.default.id
  target_type = "instance"
  tags        = local.tags
}

resource "aws_lb_target_group" "api" {
  name        = "wcl-api"
  port        = 4000
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.default.id
  target_type = "instance"
  tags        = local.tags

  health_check {
    path = "/health"
  }
}

resource "aws_lb_target_group" "grafana" {
  name        = "wcl-grafana"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.default.id
  target_type = "instance"
  tags        = local.tags

  health_check {
    path = "/api/health"
  }
}

# --- Instance attachments ---
resource "aws_lb_target_group_attachment" "hallticket" {
  target_group_arn = aws_lb_target_group.hallticket.arn
  target_id        = aws_instance.frontend.id
  port             = 5001
}

resource "aws_lb_target_group_attachment" "admin" {
  target_group_arn = aws_lb_target_group.admin.arn
  target_id        = aws_instance.frontend.id
  port             = 5000
}

resource "aws_lb_target_group_attachment" "api" {
  target_group_arn = aws_lb_target_group.api.arn
  target_id        = aws_instance.backend.id
  port             = 4000
}

resource "aws_lb_target_group_attachment" "grafana" {
  target_group_arn = aws_lb_target_group.grafana.arn
  target_id        = aws_instance.backend.id
  port             = 3000
}

# --- Listeners ---
# Port 80 permanently redirects to 443.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      protocol    = "HTTPS"
      port        = "443"
      status_code = "HTTP_301"
    }
  }
}

# Port 443: default to the hall-ticket portal; host rules cover the rest.
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-2016-08"
  certificate_arn   = aws_acm_certificate_validation.wildcard.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.hallticket.arn
  }
}

# --- Host-header rules ---
resource "aws_lb_listener_rule" "admin" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.admin.arn
  }

  condition {
    host_header {
      values = ["admin.${var.root_domain}"]
    }
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    host_header {
      values = ["api.${var.root_domain}"]
    }
  }
}

resource "aws_lb_listener_rule" "grafana" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 30

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.grafana.arn
  }

  condition {
    host_header {
      values = ["grafana.${var.root_domain}"]
    }
  }
}
