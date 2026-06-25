import { useState } from 'react';

export function useSubmissionLock() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const withSubmissionGuard = async <T,>(
    submitFn: () => Promise<T>,
    onError?: (error: any) => void
  ): Promise<T | undefined> => {
    if (isSubmitting) return;
    
    setIsSubmitting(true);
    try {
      return await submitFn();
    } catch (err) {
      if (onError) onError(err);
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  };

  return { isSubmitting, withSubmissionGuard };
}
