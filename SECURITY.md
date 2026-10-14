# Security

## Reporting a problem

Please do not open a public issue for a security problem.

Report it privately instead: go to the repo's [Security tab](https://github.com/yaseenarshad/yaseen-docs-app/security) and click **Report a vulnerability**. Say what you found and how to make it happen.

## Which versions get fixes

Only the newest [release](https://github.com/yaseenarshad/yaseen-docs-app/releases). Please check that the problem still happens there.

## Good to know

Yaseen Docs is a local app. It reads and writes the folders you open, and it runs plain `git` against your own repo when you turn sync on. The main process has no path jail by design: the app can reach any file that your user account can.
