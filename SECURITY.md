# Security

Report vulnerabilities privately to **support@kern-ws.com**. Include affected
version, impact, reproduction and a minimal redacted proof. Do not create a
public issue containing exploit details, tokens, customer data or private keys.

Local installs bind loopback by default. Enabling LAN or internet access needs
TLS, authentication, verified host policies and a reviewed deployment. Do not
give agent containers access to the Docker daemon. Keep Docker, Node and the
desktop runtime patched. Docker management belongs only to explicitly trusted
operator connectors.

Do not upload `.env`, backups, log dumps, database files, enrollment tokens or
signing material. Rotate exposed secrets; removing a file from a later commit
does not remove it from public history. This project currently has no published
support-window or vulnerability-response SLA.
