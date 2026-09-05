export interface User {
  id: string;
  name?: string;
  email?: string;
  image?: string;
}

export interface Game {
  id: string;
  title: string;
  description?: string;
  gameId: string;
}

export interface Project {
  id: string;
  name: string;
}

export interface GameFile {
  id: string;
  name: string;
  content: string;
}

export interface GenerationJob {
  id: string;
  status: string;
}

export interface StreamEvent {
  type: string;
  data: any;
}

export interface ProviderConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ApiConfig {
  baseUrl: string;
}

export interface Plan {
  id: string;
  name: string;
  price: number;
}
