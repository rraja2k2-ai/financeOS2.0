import { PendingReviewCard } from "./PendingReviewCard";

interface PendingReview {
  id: string;
  merchant: string;
  amount: string;
  category: string;
  confidence: number;
}

interface PendingReviewListProps {
  reviews: PendingReview[];
  onVerify: (id: string) => void;
}

export function PendingReviewList({ reviews, onVerify }: PendingReviewListProps) {
  if (reviews.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-foreground">Pending Review</h2>
      <div className="space-y-3">
        {reviews.map((review) => (
          <PendingReviewCard
            key={review.id}
            merchant={review.merchant}
            amount={review.amount}
            category={review.category}
            confidence={review.confidence}
            onVerify={() => onVerify(review.id)}
          />
        ))}
      </div>
    </div>
  );
}
