"use client";

import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import { formatDateLong, isoToDdmmyyyy } from "@/lib/format";
import type { Candidate, ExamMeta } from "@/lib/types";

const INK = "#0f172a";
const MUTED = "#475569";
const BORDER = "#cbd5e1";
const ACCENT = "#1d6ff2";
const HEADBG = "#f1f5f9";
const LABELBG = "#f8fafc";

const styles = StyleSheet.create({
  page: {
    paddingVertical: 22,
    paddingHorizontal: 30,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: INK,
  },
  frame: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 4,
    flexGrow: 1,
  },
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
  logo: { height: 46, width: 78, objectFit: "contain" },
  headerCenter: { flex: 1, alignItems: "center", paddingHorizontal: 8 },
  org: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: INK,
    textAlign: "center",
  },
  docType: {
    marginTop: 3,
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: ACCENT,
    letterSpacing: 0.5,
  },
  examTitle: { marginTop: 2, fontSize: 9, color: MUTED, textAlign: "center" },

  sectionBar: {
    backgroundColor: INK,
    color: "#ffffff",
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.6,
    paddingVertical: 4.5,
    paddingHorizontal: 10,
  },
  body: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 12 },
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
    backgroundColor: LABELBG,
    borderRightWidth: 1,
    borderRightColor: BORDER,
    paddingVertical: 5.5,
    paddingHorizontal: 8,
    justifyContent: "center",
  },
  tdValue: {
    paddingVertical: 5.5,
    paddingHorizontal: 8,
    justifyContent: "center",
  },
  tdBorderRight: {
    borderRightWidth: 1,
    borderRightColor: BORDER,
  },
  labelText: {
    fontSize: 7.5,
    color: MUTED,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  valueText: { fontSize: 9.5, fontFamily: "Helvetica-Bold", color: INK },

  instrItem: { flexDirection: "row", marginBottom: 5, paddingRight: 6 },
  instrNum: { width: 15, fontSize: 9, color: ACCENT, fontFamily: "Helvetica-Bold" },
  instrText: { flex: 1, fontSize: 9, lineHeight: 1.45, color: INK },

  signRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: "auto",
    paddingTop: 24,
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

function DetailTable({ rows }: { rows: RowSpec[] }) {
  return (
    <View style={styles.table}>
      {rows.map((cells, i) => {
        const last = i === rows.length - 1;
        return (
          <View style={last ? styles.trLast : styles.tr} key={i}>
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
  rbuLogoSrc = "/assets/rbu.png",
}: {
  candidate: Candidate;
  exam: ExamMeta;
  /** Overridable so the PDF can be rendered outside the browser (tests). */
  wclLogoSrc?: string;
  rbuLogoSrc?: string;
}) {
  return (
    <Document
      title={`WCL Hall Ticket ${candidate.employeeId}`}
      author="Western Coalfields Limited"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.frame}>
          {/* Header with both logos */}
          <View style={styles.header}>
            <Image style={styles.logo} src={wclLogoSrc} />
            <View style={styles.headerCenter}>
              <Text style={styles.org}>Western Coalfields Limited</Text>
              <Text style={styles.docType}>EXAMINATION HALL TICKET</Text>
              <Text style={styles.examTitle}>
                {exam.title}, {exam.subtitle}
              </Text>
            </View>
            <Image style={styles.logo} src={rbuLogoSrc} />
          </View>

          {/* Candidate details */}
          <Text style={styles.sectionBar}>CANDIDATE DETAILS</Text>
          <View style={styles.body}>
            <DetailTable
              rows={[
                ["Candidate Name", candidate.name, "Employee ID", candidate.employeeId],
                ["Date of Birth", isoToDdmmyyyy(candidate.dob)],
              ]}
            />
          </View>

          {/* Venue & schedule */}
          <Text style={styles.sectionBar}>VENUE, SEATING AND SCHEDULE</Text>
          <View style={styles.body}>
            <DetailTable
              rows={[
                ["Examination Centre", candidate.venueName],
                ["Address", candidate.venueAddress],
                ["Building", candidate.blockNo, "Floor", candidate.floorNo],
                ["Lab", candidate.labNo, "Seat Number", candidate.seatNo],
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
          <Text style={styles.sectionBar}>INSTRUCTIONS TO CANDIDATES</Text>
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
