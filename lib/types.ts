import type { BinaryFiles } from "@excalidraw/excalidraw/types";

export const FIXED_SECTION_IDS = ["definitions", "theorems", "exams", "exercises"] as const;

export type StudySectionId = (typeof FIXED_SECTION_IDS)[number];

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
  richText?: string | null;
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

export type LegacyQuestionCard = {
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

export type LegacyStudySection = {
  id: string;
  name: string;
  cards: Record<string, LegacyQuestionCard>;
  selectedCardId: string | null;
  draftText: string;
  createdAt: string;
  updatedAt: string;
};

export type LegacyStudyCategory = {
  id: string;
  name: string;
  cards: Record<string, LegacyQuestionCard>;
  selectedCardId: string | null;
  draftText: string;
  sections: Record<string, LegacyStudySection>;
  activeSectionId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LegacyNodeDetails = {
  detailsTable?: DetailsTable | null;
  detailsImages?: DetailsImage[];
  detailsTextBoxes?: DetailsTextBox[];
  exerciseReferences?: ExerciseReferenceItem[];
};

export type NodeDetails = {
  note: string;
  image: QuestionCardImage | null;
  legacyDetails?: LegacyNodeDetails | null;
};

export type PersistedExcalidrawAppState = Pick<
  {
    scrollX: number;
    scrollY: number;
    viewBackgroundColor: string;
    theme: "light" | "dark";
  },
  "scrollX" | "scrollY" | "viewBackgroundColor" | "theme"
> & {
  zoom?: {
    value: number;
  };
  gridSize?: number | null;
};

export type SerializableExcalidrawElement = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  [key: string]: unknown;
};

export type ExcalidrawSceneState = {
  elements: SerializableExcalidrawElement[];
  appState: PersistedExcalidrawAppState;
  files: BinaryFiles;
};

export type MapNodeMeta = {
  nodeId: string;
  elementId: string;
  labelElementId: string;
  label: string;
  childMapId: string;
  note: string;
  image: QuestionCardImage | null;
  legacyDetails?: LegacyNodeDetails | null;
  createdAt: string;
  updatedAt: string;
};

export type StudyMap = {
  id: string;
  title: string;
  kind: "main" | "section" | "child";
  parentMapId: string | null;
  parentNodeId: string | null;
  rootSectionId?: StudySectionId | null;
  nodes: Record<string, MapNodeMeta>;
  scene: ExcalidrawSceneState;
  createdAt: string;
  updatedAt: string;
};

export type StudyCategory = {
  id: string;
  name: string;
  maps: Record<string, StudyMap>;
  mainMapId: string;
  sectionMapIds: Record<StudySectionId, string>;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSnapshot = {
  version: 7;
  categories: Record<string, StudyCategory>;
  selectedCategoryId: string | null;
  categoryDraftText: string;
  activeCategoryId: string | null;
  activeMapId: string | null;
  savedAt: string;
};

export type PendingImageAsset = {
  nodeId: string;
  path: string;
  blob: Blob;
};
