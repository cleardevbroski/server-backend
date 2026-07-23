jest.mock("cloudinary", () => ({
  v2: {
    config: jest.fn(),
    uploader: { upload: jest.fn() },
  },
}));

const cloudinary = require("cloudinary").v2;
const { uploadIfBase64, uploadArrayIfBase64 } = require("../src/utils/mediaUpload");

describe("mediaUpload helper", () => {
  beforeEach(() => cloudinary.uploader.upload.mockReset());

  it("uploads a base64 data URI and returns the secure_url", async () => {
    cloudinary.uploader.upload.mockResolvedValue({
      secure_url: "https://res.cloudinary.com/demo/image/upload/x.jpg",
    });

    const result = await uploadIfBase64("data:image/png;base64,AAAA", {
      resourceType: "image",
      folder: "clear-title/properties",
    });

    expect(cloudinary.uploader.upload).toHaveBeenCalledWith("data:image/png;base64,AAAA", {
      resource_type: "image",
      folder: "clear-title/properties",
    });
    expect(result).toBe("https://res.cloudinary.com/demo/image/upload/x.jpg");
  });

  it("passes through a value that is already a URL, without calling Cloudinary", async () => {
    const result = await uploadIfBase64("https://res.cloudinary.com/demo/image/upload/existing.jpg");
    expect(cloudinary.uploader.upload).not.toHaveBeenCalled();
    expect(result).toBe("https://res.cloudinary.com/demo/image/upload/existing.jpg");
  });

  it("passes through non-string/empty values unchanged", async () => {
    expect(await uploadIfBase64("")).toBe("");
    expect(await uploadIfBase64(undefined)).toBe(undefined);
  });

  it("uploads only the base64 entries of an array, leaving hosted URLs untouched", async () => {
    cloudinary.uploader.upload.mockResolvedValue({
      secure_url: "https://res.cloudinary.com/demo/image/upload/y.jpg",
    });

    const result = await uploadArrayIfBase64(
      ["data:image/png;base64,BBBB", "https://res.cloudinary.com/demo/image/upload/existing.jpg"],
      { resourceType: "image", folder: "clear-title/properties" }
    );

    expect(result).toEqual([
      "https://res.cloudinary.com/demo/image/upload/y.jpg",
      "https://res.cloudinary.com/demo/image/upload/existing.jpg",
    ]);
  });

  it("returns non-array input unchanged", async () => {
    expect(await uploadArrayIfBase64(undefined)).toBe(undefined);
  });
});
