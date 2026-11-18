# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/toller892/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/toller892/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks every pre-token protocol in DefiLlama's index by what its launch would be worth, and shows how to farm each one. The board covers the whole 40-protocol watchlist plus every other rankable pre-token protocol below the floor, scores each with the radar-2 model (TVL, seven-day growth, age with no token, chain breadth), and sets the live-token protocols aside with their market caps. A protocol reaches the board only when it records no token and is not a wrapped, staked or bridged product of a token that already trades. The dashboard is a static page with a sortable, filterable board, a detail view for every protocol with its model breakdown and seven-step farm plan, and a model sandbox that re-ranks the board live.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

`main.ts` reads the sealed snapshot, writes the ranked board to `out/board.json`, the dashboard data to `out/data.js`, and copies `dashboard/` and `screenshots/` to `out/` with `out/dossier.json`. It needs Node.js 22.18 or later and nothing else.

---

<sub>Entered on [make.fun](https://make.fun/?ref=e484k5h4&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
