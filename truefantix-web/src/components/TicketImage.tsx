"use client";

interface TicketImageProps {
  src: string;
  alt: string;
  fallbackSrc?: string;
}

export default function TicketImage({ src, alt, fallbackSrc = "/default.jpg" }: TicketImageProps) {
  return (
    <img
      src={src || fallbackSrc}
      alt={alt}
      className="w-full h-full object-cover"
      onError={(e) => { 
        (e.target as HTMLImageElement).src = fallbackSrc; 
      }}
    />
  );
}
