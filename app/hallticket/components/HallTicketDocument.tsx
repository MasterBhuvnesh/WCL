"use client";

import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import { formatDateLong } from "@/lib/format";
import type { Candidate, ExamMeta } from "@/lib/types";

const INK = "#0f172a";
const MUTED = "#475569";
const BORDER = "#cbd5e1";
const ACCENT = "#1d6ff2";
const HEADBG = "#f1f5f9";

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
  body: { paddingHorizontal: 12, paddingTop: 13, paddingBottom: 9 },
  /** The instructions body grows to fill the page so the footer sits at the bottom. */
  bodyGrow: { flexGrow: 1 },

  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "50%", marginBottom: 10, paddingRight: 10 },
  cellWide: { width: "100%", marginBottom: 10, paddingRight: 10 },
  label: {
    fontSize: 7.5,
    color: MUTED,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  value: { fontSize: 11, fontFamily: "Helvetica-Bold", color: INK },

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

function Field({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <View style={wide ? styles.cellWide : styles.cell}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

/**
 * The hall ticket itself — a single A4 page. This is the one source of truth
 * for both the on-screen preview and the downloaded PDF.
 */
export function HallTicketDocument({
  candidate,
  exam,
  wclLogoSrc = "/assets/wcl.png",
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
            <View style={styles.grid}>
              <Field label="Candidate Name" value={candidate.name} />
              <Field label="Employee ID" value={candidate.employeeId} />
            </View>
          </View>

          {/* Venue & schedule */}
          <Text style={styles.sectionBar}>VENUE, SEATING AND SCHEDULE</Text>
          <View style={styles.body}>
            <View style={styles.grid}>
              <Field label="Examination Centre" value={candidate.venueName} wide />
              <Field label="Address" value={candidate.venueAddress} wide />
              <Field label="Building" value={candidate.blockNo} />
              <Field label="Floor" value={candidate.floorNo} />
              <Field label="Lab" value={candidate.labNo} />
              <Field label="Seat Number" value={candidate.seatNo} />
              <Field
                label="Examination Date"
                value={formatDateLong(candidate.examDate)}
              />
              <Field
                label="Pattern"
                value={`${exam.totalQuestions} questions, single choice, ${exam.durationMinutes} minutes`}
              />
              <Field label="Reporting Time" value={candidate.reportingTime} />
              <Field label="Gate Closes" value={candidate.gateClosesTime} />
              <Field label="Examination Begins" value={candidate.examTime} />
              <Field label="Marking" value={exam.markingScheme} />
            </View>
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
