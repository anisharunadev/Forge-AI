{{/*
reference-service Helm chart helpers.
Enforces artifact-generator v0.2 §4.4 (non-root, readOnlyRootFilesystem).
*/}}

{{/* Chart name + fullname */}}
{{- define "reference-service.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "reference-service.fullname" -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{/* ServiceAccount name (matches Terraform oidc assume-role condition) */}}
{{- define "reference-service.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (printf "%s-sa" (include "reference-service.fullname" .)) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* Common labels */}}
{{- define "reference-service.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "reference-service.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "reference-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "reference-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
