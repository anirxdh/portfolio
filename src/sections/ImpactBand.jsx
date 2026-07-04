import { stats } from '../constants/index.js';
import Counter from '../components/Counter.jsx';

const ImpactBand = () => {
  return (
    <section className="c-space my-20 reveal-up">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 rounded-2xl border border-black-300 bg-black-200 py-12 px-6">
        {stats.map((s) => (
          <Counter key={s.label} value={s.value} suffix={s.suffix} label={s.label} />
        ))}
      </div>
    </section>
  );
};

export default ImpactBand;
