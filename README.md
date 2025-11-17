# Dover Patrol - Online Multiplayer Game

An online multiplayer version of the Dover Patrol naval strategy game.

## Local Development

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

3. Open your browser to `http://localhost:3000`

## Deployment

This app is deployed on Railway and can be accessed via the public URL provided by Railway.

This app can also be deployed to:
- **Railway** (recommended): https://railway.app
- **Render**: https://render.com
- **Fly.io**: https://fly.io

### Deploying to Railway

1. Sign up at https://railway.app
2. Click "New Project" → "Deploy from GitHub repo"
3. Connect your GitHub account and select this repository
4. Railway will automatically detect Node.js and deploy
5. Your app will be live at a URL like `https://your-app-name.up.railway.app`

### Deploying to Render

1. Sign up at https://render.com
2. Click "New" → "Web Service"
3. Connect your GitHub repository
4. Set:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Click "Create Web Service"
6. Your app will be live at a URL like `https://your-app-name.onrender.com`

## How to Play

1. **Host**: Click "Create Room" to start a new game
2. **Player 2**: Enter the room code shared by the host
3. Both players place their pieces on the board
4. The game randomly selects who starts
5. Take turns moving and attacking pieces
6. First player to reach the opponent's base wins!

## Game Rules

- Each piece can move once per turn
- Pieces can only attack forward
- Flying Boats can jump over pieces and move up to 2 squares
- Flying Boats can jump the harbor wall (1 square only)
- Mines cannot move but destroy most pieces (suicide)
- First player to enter the opponent's base wins
