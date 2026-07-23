"use client";

import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import { formatDateLong, isoToDdmmyyyy } from "@/lib/format";
import type { Candidate, ExamMeta } from "@/lib/types";

// Inter, bundled as WOFF in public/fonts so the PDF renders the same typeface
// as the on-screen portal without depending on an external CDN.
Font.register({
  family: "Inter",
  fonts: [
    { src: "/fonts/inter-400.woff", fontWeight: 400 },
    { src: "/fonts/inter-700.woff", fontWeight: 700 },
  ],
});

const INK = "#0f172a";
const MUTED = "#475569";
const BORDER = "#cbd5e1";
const HEADBG = "#f1f5f9";

const styles = StyleSheet.create({
  page: {
    paddingVertical: 22,
    paddingHorizontal: 30,
    fontSize: 10,
    fontFamily: "Inter",
    color: INK,
  },
  frame: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 4,
    flexGrow: 1,
  },

  /* Header */
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: HEADBG,
  },
  logo: { height: 58, width: 98, objectFit: "contain" },
  headerCenter: { flex: 1, alignItems: "center", paddingHorizontal: 8 },
  org: {
    fontSize: 15,
    fontFamily: "Inter", fontWeight: "bold",
    color: INK,
    textAlign: "center",
  },
  examTitle: { marginTop: 3, fontSize: 12, color: MUTED, textAlign: "center" },
  headerRight: { alignItems: "flex-end", width: 78 },
  docTypeSmall: { fontSize: 7, color: MUTED },
  docTypeBig: {
    fontSize: 12,
    fontFamily: "Inter", fontWeight: "bold",
    color: INK,
    textAlign: "right",
  },

  sectionBar: {
    backgroundColor: INK,
    color: "#ffffff",
    fontSize: 9,
    fontFamily: "Inter", fontWeight: "bold",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  body: { paddingHorizontal: 12, paddingTop: 9, paddingBottom: 9 },
  /** The instructions body grows to fill the page so the footer sits at the bottom. */
  bodyGrow: { flexGrow: 1 },

  /* Bordered label/value table */
  table: {
    borderWidth: 1,
    borderColor: BORDER,
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  trLast: { flexDirection: "row" },
  tdLabel: {
    borderRightWidth: 1,
    borderRightColor: BORDER,
    paddingVertical: 4.5,
    paddingHorizontal: 8,
    justifyContent: "center",
  },
  tdValue: {
    paddingVertical: 4.5,
    paddingHorizontal: 8,
    justifyContent: "center",
  },
  tdBorderRight: {
    borderRightWidth: 1,
    borderRightColor: BORDER,
  },
  labelText: {
    fontSize: 8.5,
    color: MUTED,
  },
  valueText: { fontSize: 9.5, fontFamily: "Inter", fontWeight: "bold", color: INK },

  /* Candidate details sit left of the passport-photo box */
  candidateRow: { flexDirection: "row", alignItems: "stretch", gap: 9 },
  candidateTable: { flex: 1, flexDirection: "column" },
  /* 35mm x 45mm — actual passport-photo size — so the pasted photo fits the box */
  photoBox: {
    width: 99,
    height: 128,
    borderWidth: 1,
    borderColor: MUTED,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  photoBoxText: {
    fontSize: 7,
    color: MUTED,
    textAlign: "center",
    lineHeight: 1.4,
  },

  instrItem: { flexDirection: "row", marginBottom: 4, paddingRight: 6 },
  instrNum: { width: 15, fontSize: 8.5, color: MUTED, fontFamily: "Inter", fontWeight: "bold" },
  instrText: { flex: 1, fontSize: 8.5, lineHeight: 1.4, color: INK },

  signRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: "auto",
    paddingTop: 34,
    paddingHorizontal: 4,
  },
  signBox: { width: "40%", alignItems: "center" },
  signLine: {
    borderTopWidth: 1,
    borderTopColor: MUTED,
    width: "100%",
    paddingTop: 3,
    alignItems: "center",
  },
  signLabel: { fontSize: 8, color: MUTED },

  footer: {
    marginTop: 10,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    fontSize: 7.5,
    color: MUTED,
    textAlign: "center",
    lineHeight: 1.35,
  },
});

/**
 * One table row: [label, value] renders the value across the full width;
 * [label, value, label, value] renders two label/value pairs side by side.
 */
type RowSpec = [string, string] | [string, string, string, string];

// `fill` stretches the rows evenly to the parent's height (used to match the
// candidate table to the photo box beside it).
function DetailTable({ rows, fill }: { rows: RowSpec[]; fill?: boolean }) {
  return (
    <View style={fill ? [styles.table, { flexGrow: 1 }] : styles.table}>
      {rows.map((cells, i) => {
        const last = i === rows.length - 1;
        const tr = last ? styles.trLast : styles.tr;
        return (
          <View style={fill ? [tr, { flexGrow: 1 }] : tr} key={i}>
            {cells.length === 2 ? (
              <>
                <View style={[styles.tdLabel, { width: "22%" }]}>
                  <Text style={styles.labelText}>{cells[0]}</Text>
                </View>
                <View style={[styles.tdValue, { width: "78%" }]}>
                  <Text style={styles.valueText}>{cells[1]}</Text>
                </View>
              </>
            ) : (
              <>
                <View style={[styles.tdLabel, { width: "22%" }]}>
                  <Text style={styles.labelText}>{cells[0]}</Text>
                </View>
                <View style={[styles.tdValue, styles.tdBorderRight, { width: "28%" }]}>
                  <Text style={styles.valueText}>{cells[1]}</Text>
                </View>
                <View style={[styles.tdLabel, { width: "22%" }]}>
                  <Text style={styles.labelText}>{cells[2]}</Text>
                </View>
                <View style={[styles.tdValue, { width: "28%" }]}>
                  <Text style={styles.valueText}>{cells[3]}</Text>
                </View>
              </>
            )}
          </View>
        );
      })}
    </View>
  );
}

/**
 * The hall ticket itself — a single A4 page. This is the one source of truth
 * for both the on-screen preview and the downloaded PDF; keep
 * HallTicketPreview.tsx in step with any layout change here.
 */
export function HallTicketDocument({
  candidate,
  exam,
  wclLogoSrc = "/assets/wcl.logo.png",
}: {
  candidate: Candidate;
  exam: ExamMeta;
  /** Overridable so the PDF can be rendered outside the browser (tests). */
  wclLogoSrc?: string;
}) {
  return (
    <Document
      title={`WCL Hall Ticket ${candidate.employeeId}`}
      author="Western Coalfields Limited"
    >
      <Page size="A4" wrap={false} style={styles.page}>
        <View style={styles.frame}>
          {/* Header: logo, organisation, document badge */}
          <View style={styles.header}>
            <Image style={styles.logo} src={wclLogoSrc} />
            <View style={styles.headerCenter}>
              <Text style={styles.org}>Western Coalfields Limited</Text>
              <Text style={styles.examTitle}>
                {exam.title}, {exam.subtitle}
              </Text>
            </View>
            <View style={styles.headerRight}>
              <Text style={styles.docTypeSmall}>Examination</Text>
              <Text style={styles.docTypeBig}>Hall Ticket</Text>
            </View>
          </View>

          {/* Candidate details */}
          <Text style={styles.sectionBar}>Candidate Details</Text>
          <View style={styles.body}>
            <View style={styles.candidateRow}>
              <View style={styles.candidateTable}>
                <DetailTable
                  fill
                  rows={[
                    ["Candidate Name", candidate.name],
                    ["Employee ID", candidate.employeeId],
                    ["Date of Birth", isoToDdmmyyyy(candidate.dob)],
                  ]}
                />
              </View>
              <View style={styles.photoBox}>
                <Text style={styles.photoBoxText}>
                  Affix a recent passport-size photograph here
                </Text>
              </View>
            </View>
          </View>

          {/* Venue, seating and schedule */}
          <Text style={styles.sectionBar}>Venue, Seating and Schedule</Text>
          <View style={styles.body}>
            <DetailTable
              rows={[
                ["Examination Centre", candidate.venueName],
                ["Address", candidate.venueAddress],
                ["Building", candidate.blockNo, "Floor", candidate.floorNo],
                ["Lab", candidate.labNo, "Entry Gate", candidate.gateNo],
                [
                  "Examination Date",
                  formatDateLong(candidate.examDate),
                  "Reporting Time",
                  candidate.reportingTime,
                ],
                [
                  "Gate Closes",
                  candidate.gateClosesTime,
                  "Examination Begins",
                  candidate.examTime,
                ],
                [
                  "Pattern",
                  `${exam.totalQuestions} questions, single choice, ${exam.durationMinutes} minutes`,
                ],
                ["Marking", exam.markingScheme],
              ]}
            />
          </View>

          {/* Instructions */}
          <Text style={styles.sectionBar}>Instructions to Candidates</Text>
          <View style={[styles.body, styles.bodyGrow]}>
            {exam.instructions.map((line, i) => (
              <View style={styles.instrItem} key={i}>
                <Text style={styles.instrNum}>{i + 1}.</Text>
                <Text style={styles.instrText}>{line}</Text>
              </View>
            ))}

            <View style={styles.signRow}>
              <View style={styles.signBox}>
                <View style={styles.signLine}>
                  <Text style={styles.signLabel}>Candidate&apos;s Signature</Text>
                </View>
              </View>
              <View style={styles.signBox}>
                <View style={styles.signLine}>
                  <Text style={styles.signLabel}>Invigilator&apos;s Signature</Text>
                </View>
              </View>
            </View>

            <Text style={styles.footer}>
              This is a computer-generated hall ticket. Please verify all details
              and report any discrepancy before the examination date.{"\n"}
              Western Coalfields Limited. Examination conducted at Ramdeobaba
              University, Nagpur.
            </Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
