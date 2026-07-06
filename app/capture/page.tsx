"use client";

import { useState } from "react";
import { CaptureHero } from "@/components/capture/CaptureHero";
import { CaptureActions } from "@/components/capture/CaptureActions";
import { CapturePrompt } from "@/components/capture/CapturePrompt";
import { PendingReviewList } from "@/components/capture/PendingReviewList";

interface PendingReview {
  id: string;
  merchant: string;
  amount: string;
  category: string;
  confidence: number;
}

const DEMO_REVIEWS: PendingReview[] = [
  {
    id: "1",
    merchant: "NTUC FairPrice",
    amount: "$45.80",
    category: "Groceries",
    confidence: 95,
  },
  {
    id: "2",
    merchant: "Starbucks",
    amount: "$8.50",
    category: "Food & Beverage",
    confidence: 88,
  },
];

export default function CapturePage() {
  const [prompt, setPrompt] = useState("");
  const [reviews, setReviews] = useState<PendingReview[]>(DEMO_REVIEWS);

  const handleCameraClick = () => {
    // TODO: Implement camera logic
  };

  const handleUploadClick = () => {
    // TODO: Implement upload logic
  };

  const handlePasteClick = () => {
    // TODO: Implement paste logic
  };

  const handlePromptSubmit = () => {
    // TODO: Implement prompt submission
  };

  const handleVerifyReview = (id: string) => {
    setReviews((prev) => prev.filter((review) => review.id !== id));
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-2xl space-y-6">
        <CaptureHero />

        {/* Context Input - Hero of the page */}
        <div className="space-y-3">
          <CapturePrompt
            value={prompt}
            onChange={setPrompt}
            onSubmit={handlePromptSubmit}
          />
          <CaptureActions
            onCameraClick={handleCameraClick}
            onUploadClick={handleUploadClick}
            onPasteClick={handlePasteClick}
          />
        </div>

        {/* Pending Review */}
        <PendingReviewList reviews={reviews} onVerify={handleVerifyReview} />
      </div>
    </div>
  );
}
