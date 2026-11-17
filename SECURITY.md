# Security

optkit fails closed. No default credentials exist. Owner sessions require a configured password hash and session secret. API keys are stored hashed. Subscriber confirm and unsubscribe links use HMAC-signed tokens. Do not log secrets or tokens. Report vulnerabilities to the maintainer.
