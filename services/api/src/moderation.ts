import type { Repository } from "./repository";

export interface ModerationResult {
  ok: boolean;
  lines: string[];
}

const USAGE = [
  "Usage:",
  "  reports [--all]    list open reports (--all includes resolved ones)",
  "  dismiss <id>       mark a report handled and leave the share as it is",
  "  unlist <code>      take a share off the browse pages; its link keeps working",
  "  remove <code>      withdraw a share so its link stops working, with its reports",
];

/**
 * What an operator can do about a report, as plain functions over the
 * repository so the same code runs from the command line and from a test.
 *
 * `unlist` and `remove` act on a share, never on the owner's list: the list is
 * theirs, the public link is what was reported.
 */
export async function moderate(
  args: readonly string[],
  repository: Repository,
  now: () => Date = () => new Date(),
): Promise<ModerationResult> {
  const [command, target] = args;

  switch (command) {
    case "reports": {
      const rows = await repository.listReports({ open: !args.includes("--all") });
      if (rows.length === 0) return { ok: true, lines: ["No open reports."] };
      return {
        ok: true,
        lines: rows.map((r) =>
          [
            r.id,
            r.createdAt.toISOString(),
            `share ${r.shareCode}`,
            r.reason,
            r.resolvedAt ? "resolved" : "open",
            r.note ? JSON.stringify(r.note) : "",
          ]
            .filter((part) => part !== "")
            .join("  "),
        ),
      };
    }

    case "dismiss": {
      if (!target) return { ok: false, lines: USAGE };
      const found = await repository.resolveReport(target, now());
      return found
        ? { ok: true, lines: [`Report ${target} dismissed.`] }
        : { ok: false, lines: [`No report ${target}.`] };
    }

    case "unlist": {
      if (!target) return { ok: false, lines: USAGE };
      const share = await repository.findShareByCode(target);
      if (!share) return { ok: false, lines: [`No share ${target}.`] };
      await repository.setShareListed(target, false);
      return { ok: true, lines: [`Share ${target} is no longer listed.`] };
    }

    case "remove": {
      if (!target) return { ok: false, lines: USAGE };
      const removed = await repository.deleteShareByCode(target);
      return removed
        ? { ok: true, lines: [`Share ${target} removed.`] }
        : { ok: false, lines: [`No share ${target}.`] };
    }

    default:
      return { ok: false, lines: USAGE };
  }
}
