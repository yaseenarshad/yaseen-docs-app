# Contributing

Thanks for wanting to help. This page is the short version. The [developer page](docs/DEVELOPMENT.md) has every detail.

## Found a bug or have an idea

Open an [issue](https://github.com/yaseenarshad/yaseen-docs-app/issues). For a bug, say what you did, what you expected and what happened. A small note that shows the problem helps a lot.

For a security problem, do not open an issue. See [SECURITY.md](SECURITY.md).

## Run it

You need Node 20.19 or newer.

```bash
npm install
npm run dev
```

## Before you open a pull request

Open an issue first for anything bigger than a small fix, so we can agree on the shape before you write it.

Then make sure these pass. CI runs the same ones.

```bash
npm run typecheck
npm test
npm run build
npm run perf:budget:ci
```

If you change how the app behaves, add or update a test, and update [docs/FEATURES.md](docs/FEATURES.md) or [docs/CONTRACTS.md](docs/CONTRACTS.md) when they describe that behavior.

## About the ticket numbers

The code and docs carry tags like `YAZ-1234` and `GRO-1234`. They point at a private issue tracker. You do not need them: the comment or doc beside each tag is meant to stand on its own.

## License

By contributing you agree that your work is released under the [MIT license](LICENSE).
