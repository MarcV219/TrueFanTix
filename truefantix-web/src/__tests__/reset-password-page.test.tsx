import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ResetPasswordPage from "@/app/reset-password/page";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () =>
    new URLSearchParams(
      "token=0123456789abcdef0123456789abcdef&userId=cmap0reset0000user00000000"
    ),
}));

describe("ResetPasswordPage", () => {
  it("submits emailed reset links to the password reset token endpoint", async () => {
    const user = userEvent.setup();
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ResetPasswordPage />);

    const passwordFields = screen.getAllByPlaceholderText("••••••••••");
    await user.type(passwordFields[0], "NewPassword123");
    await user.type(passwordFields[1], "NewPassword123");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/forgot-password",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          token: "0123456789abcdef0123456789abcdef",
          userId: "cmap0reset0000user00000000",
          newPassword: "NewPassword123",
        }),
      })
    );
  });
});
