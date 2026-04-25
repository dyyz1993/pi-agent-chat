import type { ComponentType } from "react";
import type { PreviewDetails, ResourceType } from "./types";
import { ImageCard } from "./ImageCard";
import { UrlCard } from "./UrlCard";
import { HtmlCard } from "./HtmlCard";
import { PdfCard } from "./PdfCard";
import { VideoCard } from "./VideoCard";
import { AudioCard } from "./AudioCard";
import { MarkdownCard } from "./MarkdownCard";
import { TextCard } from "./TextCard";
import { FallbackCard } from "./FallbackCard";

interface CardProps {
  details: PreviewDetails;
}

const CARD_MAP: Record<ResourceType, ComponentType<CardProps>> = {
  image: ImageCard,
  url: UrlCard,
  html: HtmlCard,
  pdf: PdfCard,
  video: VideoCard,
  audio: AudioCard,
  markdown: MarkdownCard,
  text: TextCard,
};

export { ImageCard, UrlCard, HtmlCard, PdfCard, VideoCard, AudioCard, MarkdownCard, TextCard, FallbackCard };

export function PreviewCard({ details }: { details: PreviewDetails }) {
  const Card = CARD_MAP[details.resourceType] ?? FallbackCard;
  return <Card details={details} />;
}

export type { PreviewDetails, ResourceType };
