import { schemas } from "@/lib/validation";

const tinyPhoto = "data:image/jpeg;base64,YQ==";

describe("forum photo validation", () => {
  it("accepts up to three safe image uploads on new discussions", () => {
    const result = schemas.forumThreadCreateApi.safeParse({
      title: "Welcome to the community",
      body: "This is our first discussion.",
      topicType: "OTHER",
      imageUrls: [tinyPhoto, tinyPhoto, tinyPhoto],
    });

    expect(result.success).toBe(true);
  });

  it("accepts photos on replies", () => {
    const result = schemas.forumPostCreateApi.safeParse({
      threadId: "clz1234567890123456789012",
      body: "Here is a photo from the event.",
      imageUrls: ["data:image/webp;base64,YQ=="],
    });

    expect(result.success).toBe(true);
  });

  it("rejects unsupported files and more than three photos", () => {
    expect(schemas.forumThreadCreateApi.safeParse({ title: "A valid title", body: "A valid body", imageUrls: ["data:image/svg+xml;base64,YQ=="] }).success).toBe(false);
    expect(schemas.forumThreadCreateApi.safeParse({ title: "A valid title", body: "A valid body", imageUrls: [tinyPhoto, tinyPhoto, tinyPhoto, tinyPhoto] }).success).toBe(false);
  });
});
