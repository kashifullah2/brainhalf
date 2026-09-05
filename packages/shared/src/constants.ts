export const WEB_URL = "https://brainhalf.com";
export const API_URL = "https://brainhalf-api.kashifullah919.workers.dev";
export const STUDIO_URL = "https://studio.brainhalf.com";

export const PLANS = {
  free: { maxProjects: 3, credits: 10 },
  pro: { maxProjects: -1, credits: 100 },
  studio: { maxProjects: -1, credits: 1000 }
};

export const CREDIT_COSTS = {
  simple_2d: 10,
  standard_3d: 25
};

export const GENRES = [
  "Action", "Adventure", "Puzzle", "RPG", "Simulation", "Strategy"
];

export const ENGINES = [
  "Phaser", "Three.js", "Pixi.js"
];
