# Dependency update for Edu 3.0.0-rc.1

The production dependency lock was updated to resolve the known audit findings present in the earlier lock. The candidate lock was audited with zero reported production vulnerabilities, then used by the three-platform candidate CI. A clean audit does not rule out unknown vulnerabilities.

| Package | Earlier lock | Candidate lock |
|---|---:|---:|
| body-parser | 2.3.0 | 2.4.0 |
| fast-uri | 3.1.8 | 3.1.9 |
| ip-address | 10.7.3 | 10.7.5 |
| qs | 6.16.0 | 6.16.1 |
| zod | 4.6.5 | 4.6.7 |

The public CI run for this commit should be checked before a release is published.
