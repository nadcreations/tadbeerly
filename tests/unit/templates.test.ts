import { describe, expect, test } from "vitest";
import {
  appUrl,
  compose,
  invitationAcceptedEmail,
  passwordResetEmail,
  userInvitationEmail,
} from "@/lib/email/templates";

describe("email templates", () => {
  test("names are escaped in HTML", () => {
    const c = userInvitationEmail({
      inviterName: "Alice",
      organizationName: "Meridian",
      firstName: "<img src=x onerror=alert(1)>",
      url: "http://localhost:3000/invitations/t",
    });
    expect(c.html).not.toContain("<img src=x");
    expect(c.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  test("the invitation carries its subject, button and absolute link", () => {
    const c = userInvitationEmail({
      inviterName: "Alice",
      organizationName: "Meridian",
      firstName: "Sam",
      url: "http://localhost:3000/invitations/t",
    });
    expect(c.subject).toBe("You're invited to Meridian on Tadbeerly");
    expect(c.html).toContain("Accept invitation");
    expect(c.html).toContain('href="http://localhost:3000/invitations/t"');
    expect(c.text).toContain("Accept invitation: http://localhost:3000/invitations/t");
  });

  test("invitation accepted points at the agents admin page", () => {
    const c = invitationAcceptedEmail({ name: "Sam", organizationName: "Meridian" });
    expect(c.subject).toBe("Sam joined Meridian");
    expect(c.html).toContain("Open Tadbeerly");
    expect(c.text).toContain(appUrl("/admin/agents"));
  });

  test("password reset names the expiry and the wordmark replaces the icon", () => {
    const c = passwordResetEmail({
      firstName: "Sam",
      url: "http://localhost:3000/reset/t",
      expiresInLabel: "60 minutes",
    });
    expect(c.subject).toBe("Reset your Tadbeerly password");
    expect(c.text).toContain("60 minutes");
    expect(c.html).toContain("Choose a new password");
    expect(c.html).toContain("Tadbeerly");
    expect(c.html).not.toContain("<img");
    expect(c.html).toContain("Manage your account");
    expect(c.html).toContain(appUrl("/security"));
  });

  test("compose escapes every user-supplied field", () => {
    const c = compose({
      subject: "s",
      heading: "<b>h</b>",
      intro: "<i>i</i>",
      facts: [["<l>", "<v>"]],
      quote: "<q>",
      action: { label: "<a>", url: "http://x/?a=1&b=2" },
    });
    expect(c.html).not.toMatch(/<(b|i|l|v|q|a)>/);
    expect(c.html).toContain("a=1&amp;b=2");
  });
});
