#!/bin/bash
echo "Starting backend server..."
npx tsx server/index.ts &
BACKEND_PID=$!

echo "Starting frontend..."
npm run dev &

echo "Backend running on http://localhost:3001"
echo "Frontend running on http://localhost:5173"

wait
