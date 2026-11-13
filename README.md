# Hazel Party 🐾

A 2-player online party game for phones starring Ralph, Jordan and Hazel the Bernedoodle.
Six mini-games (Hazel Dash, Treat Toss, Who's the Favorite?, Snack Snatch, Zoomies Race, optional Chess);
win a round to score a point, first to the target score wins.

## Play
1. Open the site and tap **Create Room**.
2. Share the 4-letter code or the invite link (`?r=CODE`) with the other player.
3. Choose the target score / chess on or off, then **Start**.

## Run locally
```
npm install
npm start   # http://localhost:3000 (or $PORT)
```

## Deploy (Render)
New → Blueprint (or Web Service) from this repo. `render.yaml` sets build `npm install`, start `npm start`, free plan.

## Hazel Chess (standalone)
A mobile-first chess app with chess.com-style arrows that work on a phone.

Play at **https://hazel-party.onrender.com/chess**

- Online 2-player (room code), vs bot, or a free analysis board
- Draw arrows (drag) and highlight squares — also long-press, two-finger, or right-click on desktop
- Installable to the iPhone home screen (Add to Home Screen)
- The party game at `/` is unchanged
