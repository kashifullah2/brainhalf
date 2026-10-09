export interface GalleryApp {
  id: string;
  name: string;
  description: string;
  remixCount: number;
  showcasedAt?: number | null;
  productionUrl?: string;
}
