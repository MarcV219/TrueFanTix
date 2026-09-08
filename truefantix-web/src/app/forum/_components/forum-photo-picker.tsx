"use client";

import { useRef } from "react";
import { useLanguage } from "@/app/_components/language-provider";

export const MAX_FORUM_PHOTOS = 3;
export const MAX_FORUM_PHOTO_BYTES = 2 * 1024 * 1024;

type Props = {
  photos: string[];
  onChange: (photos: string[]) => void;
  disabled?: boolean;
  onError: (message: string | null) => void;
};

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read that photo."));
    reader.readAsDataURL(file);
  });
}

export default function ForumPhotoPicker({ photos, onChange, disabled, onError }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { language, t } = useLanguage();

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;

    const selected = Array.from(files);
    if (photos.length + selected.length > MAX_FORUM_PHOTOS) {
      onError(`You can add up to ${MAX_FORUM_PHOTOS} photos.`);
      return;
    }

    if (selected.some((file) => !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type))) {
      onError("Photos must be JPG, PNG, WebP, or GIF files.");
      return;
    }

    if (selected.reduce((sum, file) => sum + file.size, 0) > MAX_FORUM_PHOTO_BYTES) {
      onError("The selected photos must be 2 MB or less in total.");
      return;
    }

    try {
      const encoded = await Promise.all(selected.map(readFile));
      const approximateExistingBytes = photos.reduce((sum, photo) => sum + Math.ceil(photo.length * 0.75), 0);
      if (approximateExistingBytes + selected.reduce((sum, file) => sum + file.size, 0) > MAX_FORUM_PHOTO_BYTES) {
        onError("All photos combined must be 2 MB or less.");
        return;
      }
      onChange([...photos, ...encoded]);
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not read those photos.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="mt-3">
      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">
        Photos <span className="font-normal text-gray-500">(optional, up to 3; 2 MB total)</span>
      </label>
      <div className="mt-2 flex items-center gap-3 text-sm text-gray-600 dark:text-gray-300">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || photos.length >= MAX_FORUM_PHOTOS}
          className="rounded-lg border-0 bg-blue-50 px-4 py-2 font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
        >
          {t("Choose photos")}
        </button>
        <span data-no-translate>
          {photos.length === 0
            ? t("No photos selected")
            : language === "fr"
              ? `${photos.length} photo${photos.length > 1 ? "s" : ""} sélectionnée${photos.length > 1 ? "s" : ""}`
              : `${photos.length} photo${photos.length > 1 ? "s" : ""} selected`}
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        disabled={disabled || photos.length >= MAX_FORUM_PHOTOS}
        onChange={(event) => void addPhotos(event.target.files)}
        className="sr-only"
        tabIndex={-1}
      />
      {photos.length > 0 ? (
        <div className="mt-3 grid grid-cols-3 gap-3">
          {photos.map((photo, index) => (
            <div key={`${photo.slice(0, 40)}-${index}`} className="relative overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt={`Selected photo ${index + 1}`} className="aspect-square h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => onChange(photos.filter((_, photoIndex) => photoIndex !== index))}
                disabled={disabled}
                aria-label={`Remove photo ${index + 1}`}
                className="absolute right-1 top-1 rounded-full bg-black/75 px-2 py-1 text-xs font-bold text-white"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
