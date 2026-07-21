# A-alias records for every hostname, all pointing at the ALB. The alias target
# zone id comes from the ALB itself, so no region-specific constant is needed.

locals {
  hostnames = [
    var.root_domain,             # hall-ticket portal
    "admin.${var.root_domain}",  # admin panel
    "api.${var.root_domain}",    # API
    "grafana.${var.root_domain}" # Grafana
  ]
}

resource "aws_route53_record" "alias" {
  for_each = toset(local.hostnames)

  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = false
  }
}
