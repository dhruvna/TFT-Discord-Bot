# TFT Int Log Tracker:

A Discord bot built with **Node.js**, **discord.js**, and the **Riot Games API** that allows users to register Riot IDs per server, list registered accounts, and fetch competitive data (with plans for live match tracking).

# Current Features
### Riot ID Registration (Per Server)
- Register one or more Riot IDs to a Discord server 
- Data is isolated per server using the Discord `guildId`

### List Registered Accounts
- `/list` command displays all Riot IDs registered in the current server
- Shows:
  - `gameName#tagLine (Region)`

### Persistent Storage
- Uses a local JSON database at:
  ```
  ./user_data/registrations.json
  ```
- Automatically:
  - Creates the `data/` directory if missing
  - Creates `registrations.json` if missing
- Atomic writes using a temporary file + rename

### Riot API Wrapper
- Centralized Riot API logic in `riot.js`
- Handles:
  - Riot ID → PUUID lookup
  - Region → regional routing (e.g. `na1` → `americas`)
- Sensible defaults for regional routing (configurable via env)

# Planned Features

- Live match tracking (TFT)
  - Detect when someone starts a match
  - Detect newly completed matches & update previous embed
  - Post result embeds automatically in Discord
- Leaderboard
- Add match history + match detail endpoints
- Implement `/lastmatch` command

# Progress
**Day 1: 1/22/2026**
- Discord bot created
- Riot API key refreshed daily for temporary use
- Basic node.js structure created
- Basic ping command created (/ping)
- Can fetch TFT Ranked profile summary (/rank)
- All commands need to be run manually, goal is to try automatic implementation soon

![Day 1 Progress](images/Rank_Day1_Progress.png)

**Day 2: 1/23/2026**
- Deciding on format of Discord embeds
- {Ranked/Double Up} {Victory/Defeat} for {gameName#tagLine}
- **Placement |   Rank   | {Win/Loss}**                        IMAGE?
-   1st-8th   |  D4 2LP  |  +- X LP
- Now stores registered users, need to update rank command to reflect this next
- Creates file if it didn't exist, updates atomically
- Changed platform/routing to just default to NA and to have a dropdown menu to reduce user error
Live Match Tracking
- Use league of graphs to embed the link for the match after it is finished
- Data dragon can embed some image, maybe their little legend?

![Day 2 Progress](images/Rank_Day2_Progress.png)

![Day 2 List Progress](images/List_Day2_Progress.png)

**Day 3: 1/24/2026**
- Rank command now supports dropdown, no more manual input
- Fixed issue with only one embed sending when user has ranked + double up to show
- League of graphs link shows on rank command
- Added an unregister command
- After a game, embed is sent in discord with a link to the LeagueOfGraphs page. WIP
- Keeping snapshots of last LP, last game id, etc to make this possible

![Day 3 Registration Progress](images/RegUnregister_Day3_Progress.png)
![Day 3 Tracker Progress](images/MatchTracking_Day3_Progress.png)

**Day 4: 1/25/2026**
- Fixed link structure for post game tracking
- Better updating json to track lp snapshots without error


# Project Structure

```text
.
├── index.js                # Bot entry point
├── register-commands.js    # Registers slash commands
├── commands/
│   ├── ping.js         # /ping command (test bot is alive)
│   ├── register.js         # /register command
│   ├── list.js             # /list command
│   └── rank.js             # /rank command (in progress)
├── riot.js                 # Riot Games API wrapper
├── storage.js              # JSON persistence layer
├── user_data/
│   └── registrations.json # Auto-created database file
└── README.md
```

Test Commands:
/rank gamename:dhruvna tagline:0813 
/rank gamename:ProMembean tagline:NA2 
/rank gamename:So0nMo0n tagline:NA1 