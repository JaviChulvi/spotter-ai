import SquatVideoStage from "@/components/squat/SquatVideoStage";
import SquatReport from "@/components/squat/SquatReport";
import SquatCoach from "@/components/squat/SquatCoach";
import SquatModelStatus from "@/components/squat/SquatModelStatus";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-[92rem] flex-col gap-6 px-4 py-6 sm:py-8">
      <header className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-xl">
          🏋️
        </span>
        <div>
          <h1 className="text-xl font-bold leading-tight sm:text-2xl">Spotter AI</h1>
          <p className="text-xs text-muted sm:text-sm">
            In-browser squat analysis — reps, depth &amp; bar speed live, then an
            AI coach.
          </p>
        </div>
      </header>

      {/* video · set summary · coach */}
      <div className="grid items-start gap-5 lg:grid-cols-[18rem_minmax(0,1fr)_20rem] xl:grid-cols-[22rem_minmax(0,1fr)_24rem]">
        <div className="flex flex-col gap-3 lg:sticky lg:top-6">
          <SquatModelStatus />
          <SquatVideoStage />
        </div>
        <SquatReport />
        <SquatCoach />
      </div>
    </main>
  );
}
