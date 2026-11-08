"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { deleteFeedbackAction } from "./actions";

/** A trash button on one suggestion; asks first because it cannot be undone. */
export function DeleteFeedbackButton({ id, back }: { id: string; back: string }) {
  // until the page is running, a click would post the form without the question
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <form
      action={deleteFeedbackAction}
      onSubmit={(e) => {
        if (!window.confirm("ลบข้อเสนอแนะนี้ถาวรใช่ไหม? กู้คืนไม่ได้")) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="back" value={back} />
      <button
        type="submit"
        disabled={!ready}
        aria-label="ลบข้อเสนอแนะนี้"
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-expense disabled:opacity-40"
      >
        <Trash2 className="h-4 w-4" aria-hidden />
      </button>
    </form>
  );
}
