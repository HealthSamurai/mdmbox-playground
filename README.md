# MDMbox Playground

A collection of examples that demonstrate the capabilities of [MDMbox](https://www.health-samurai.io/mdmbox).

## Set Up MDMbox

Clone this repository and run:

```bash
$ docker compose up
```

Once MDMbox is up and running, browse http://localhost:3003 and click "Sign in to activate". This will automatically issue a developer license for you.

## Examples

Once MDMbox is set up, you can explore the `examples/` directory to discover MDMbox features and try out the examples that interest you.

## Services

| Service | Image | Port | Description |
|---|---|---|---|
| `mdmbox-db` | `postgres:18` | 5438 | PostgreSQL database |
| `mdmbox` | `healthsamurai/mdmbox:edge` | 3003 | MDMbox |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `MDMBOX_URL` | `http://localhost:3003` | MDMbox API URL |
| `PORT` | `3000` | Production server port |

## License

[MIT](LICENSE) — Health Samurai
