variable "project_id" {
  description = "The GCP project id that will own every resource."
  type        = string
}

variable "region" {
  description = "The GCP region for Cloud Run, Cloud SQL, and the archive bucket."
  type        = string
  default     = "us-central1"
}

variable "image" {
  description = "The fully qualified api-server container image, for example REGION-docker.pkg.dev/PROJECT/REPO/elevated-intelligence:TAG."
  type        = string
}

variable "service_name" {
  description = "The Cloud Run service name."
  type        = string
  default     = "elevated-intelligence"
}

variable "db_tier" {
  description = "The Cloud SQL machine tier."
  type        = string
  default     = "db-custom-1-3840"
}

variable "db_name" {
  description = "The application database name."
  type        = string
  default     = "ei"
}

variable "db_user" {
  description = "The application database user."
  type        = string
  default     = "ei_app"
}

variable "db_password" {
  description = "The Cloud SQL application user password. Supplied at apply time, stored only in Secret Manager, never emitted as an output."
  type        = string
  sensitive   = true
}

variable "session_secret" {
  description = "The application session secret. Supplied at apply time, stored only in Secret Manager."
  type        = string
  sensitive   = true
}

variable "owner_email" {
  description = "The bootstrap owner email."
  type        = string
}

variable "owner_password" {
  description = "The bootstrap owner password. Supplied at apply time, stored only in Secret Manager."
  type        = string
  sensitive   = true
}

variable "deletion_protection" {
  description = "Guard the Cloud SQL instance against accidental destroy. Keep true outside throwaway environments."
  type        = bool
  default     = true
}

variable "allow_unauthenticated" {
  description = "Grant roles/run.invoker to allUsers so the Cloud Run URL is reachable by browsers and the GET /health smoke test. The application enforces its own authorization at the application layer (session-gated tenant and admin routes; intentionally public or key, token, and HMAC gated health, static, public-share, webhook, and MCP routes), so platform-level invocation is public by default and exposes no tenant data. Set false to make the service private at the edge and front it with IAP or an authenticated load balancer that holds the invoker grant."
  type        = bool
  default     = true
}
