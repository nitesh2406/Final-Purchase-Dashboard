
import React from 'react';

// FIX: Extended CardProps with React.HTMLAttributes<HTMLDivElement> to allow passing standard HTML attributes like onClick.
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
}

export const Card: React.FC<CardProps> = ({ children, className = '', ...props }) => {
  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 sm:p-6 ${className}`} {...props}>
      {children}
    </div>
  );
};
