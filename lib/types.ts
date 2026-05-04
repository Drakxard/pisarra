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
  x: number;
  y: number;
  insertedAfterText?: boolean;
};

export type DetailsImage = {
  id: string;
  path: string;
  mimeType: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  previewUrl?: string;
  pendingBlob?: Blob | null;
};

export type DetailsTextBox = {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: "small" | "medium" | "large" | "xlarge" | "huge";
  color: string;
  bold: boolean;
  strike: boolean;
  bulleted: boolean;
  align: "left" | "center" | "right";
  linkUrl?: string | null;
};

export type ExerciseReferenceItem = {
  id: string;
  sourceSectionId: "definitions" | "theorems";
  sourceCardId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
};

export type QuestionCard = {
  id: string;
  text: string;
  detailsText: string;
  detailsTable?: DetailsTable | null;
  detailsImages?: DetailsImage[];
  detailsTextBoxes?: DetailsTextBox[];
  exerciseReferences?: ExerciseReferenceItem[];
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

export type StudyCategory = {
  id: string;
  name: string;
  cards: Record<string, QuestionCard>;
  selectedCardId: string | null;
  draftText: string;
  sections: Record<string, StudySection>;
  activeSectionId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StudySection = {
  id: string;
  name: string;
  cards: Record<string, QuestionCard>;
  selectedCardId: string | null;
  draftText: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSnapshot = {
  version: 6;
  categories: Record<string, StudyCategory>;
  activeCategoryId: string | null;
  activeMapKind?: "main" | "section" | null;
  activeSectionId?: string | null;
  categoryDraftText: string;
  selectedCategoryId: string | null;
  cards?: Record<string, QuestionCard>;
  selectedCardId?: string | null;
  draftText?: string;
  savedAt: string;
};

export type PendingImageAsset = {
  cardId: string;
  path: string;
  blob: Blob;
  detailsImageId?: string;
};

export type SearchFeedback = "none" | "no-results";

export type PasteFeedback = "none" | "image-error";

export type SearchResult = {
  cardId: string;
  matchedText: string;
};
