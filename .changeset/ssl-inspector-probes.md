---
"@guardbee/mcp-ssl-inspector": minor
---

Probes for what a server still accepts, not just what a modern client negotiates: TLS 1.0/1.1, TLS 1.3 support, RSA key exchange (no forward secrecy), Diffie-Hellman group size and weak cipher families (families this runtime's OpenSSL lacks are reported as not tested). Certificate checks gain key size, SHA-1/MD5 signatures in the chain, hostname mismatch, and chain errors told apart (self-signed, incomplete chain, revoked); plus OCSP stapling and CAA. A TLS-1.0-only server is now inspected instead of reported unreachable. Fixes ChaCha20 suites being flagged as 20-bit ciphers, and the expiry warning that fired on every 90-day (Let's Encrypt) certificate.
