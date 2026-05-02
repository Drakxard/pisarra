export type CardPosition = {
  x: number;
  y: number;
};

export type CardSize = {
  width: number;
  height: number;
};

export type QuestionCardImage = {
  path: string;
  mimeType: string;
  name: string;
  width?: number;
  height?: number;
  previewUrl?: string;
  pendingBlob?: Blob | null;
};

export type DetailsTable = {
  cells: string[][];
  columnWidths: number[];
  rowHeights: number[];
  insertedAfterText: boolean;
};

export type QuestionCard = {
  id: string;
  text: string;
  detailsText: string;
  detailsTable?: DetailsTable | null;
  image: QuestionCardImage | null;
  position: CardPosition;
  size?: CardSize;
  zIndex: number;
  createdAt: string;
  updatedAt: string;
};

export type DraftImage = {
  blob: Blob;
  previewUrl: string;
  mimeType: string;
  name: string;
  width?: number;
  height?: number;
};

export type DraftState = {
  text: string;
  image: DraftImage | null;
};

export type ProjectSnapshot = {
  version: 3;
  cards: Record<string, QuestionCard>;
  selectedCardId: string | null;
  draftText: string;
  savedAt: string;
};

export type PendingImageAsset = {
  cardId: string;
  path: string;
  blob: Blob;
};

export type SearchFeedback = "none" | "no-results";

export type PasteFeedback = "none" | "image-error";

export type SearchResult = {
  cardId: string;
  matchedText: string;
};
