jest.mock("axios", () => ({ post: jest.fn() }));
jest.mock("../src/models/Otp", () => ({
  create: jest.fn(),
  deleteMany: jest.fn(),
}));

const axios = require("axios");
const Otp = require("../src/models/Otp");
const { createAndSendOTP, sendOTP } = require("../src/services/otpService");

describe("OTP delivery", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalApiKey = process.env.FAST2SMS_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = "production";
    process.env.FAST2SMS_API_KEY = "test-key";
    Otp.create.mockResolvedValue({});
    Otp.deleteMany.mockResolvedValue({});
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.FAST2SMS_API_KEY = originalApiKey;
  });

  it("does not reveal an OTP when the SMS provider rejects the request", async () => {
    axios.post.mockResolvedValue({ data: { return: false } });

    const result = await sendOTP("9876543210", "123456");

    expect(result).toMatchObject({ success: false, statusCode: 503 });
    expect(result).not.toHaveProperty("otp");
    expect(axios.post).toHaveBeenCalledWith(
      "https://www.fast2sms.com/dev/bulkV2",
      expect.objectContaining({ route: "otp", variables_values: "123456" }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "test-key" }) })
    );
  });

  it("removes an undelivered OTP so it cannot be used", async () => {
    axios.post.mockRejectedValue(new Error("provider unavailable"));

    const result = await createAndSendOTP("9876543210");

    expect(result.success).toBe(false);
    expect(Otp.deleteMany).toHaveBeenCalledTimes(2);
  });
});
