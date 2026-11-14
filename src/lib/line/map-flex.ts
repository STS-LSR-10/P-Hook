import { t } from "@/lib/i18n";
import type { LineMessage } from "@/lib/types";

/** Google Maps' directions to a place, opened in the phone's own browser or Maps app. */
export const mapsUrl = (place: string): string =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place)}&openExternalBrowser=1`;

/** A line and a button that opens Google Maps with the way to `place`. */
export function buildMapCard(place: string): LineMessage {
  return {
    type: "template",
    altText: t("เปิดแผนที่ไป {0}", place),
    template: {
      type: "buttons",
      text: t("กดเปิด Google Maps นำทางไป {0} ได้เลย (ดูสภาพรถติดในแอปได้ด้วย)", place).slice(
        0,
        160,
      ),
      actions: [{ type: "uri", label: t("เปิด Google Maps"), uri: mapsUrl(place) }],
    },
  };
}
