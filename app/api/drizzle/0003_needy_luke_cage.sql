CREATE TABLE "hallticket_seats" (
	"participant_id" uuid PRIMARY KEY NOT NULL,
	"block_no" text NOT NULL,
	"floor_no" text NOT NULL,
	"lab_no" text NOT NULL,
	"seat_no" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hallticket_seats" ADD CONSTRAINT "hallticket_seats_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;