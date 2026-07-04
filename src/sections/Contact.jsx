import emailjs from '@emailjs/browser';
import { useRef, useState } from 'react';

import useAlert from '../hooks/useAlert.js';
import Alert from '../components/Alert.jsx';

const Contact = () => {
  const formRef = useRef();

  const { alert, showAlert, hideAlert } = useAlert();
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({ name: '', email: '', message: '' });

  const handleChange = ({ target: { name, value } }) => {
    setForm({ ...form, [name]: value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setLoading(true);

    emailjs
      .send(
        import.meta.env.VITE_APP_EMAILJS_SERVICE_ID,
        import.meta.env.VITE_APP_EMAILJS_TEMPLATE_ID,
        {
          from_name: form.name,
          to_name: 'Anirudh Vasudevan',
          from_email: form.email,
          to_email: 'anirudhvasudevan11@gmail.com',
          message: form.message,
        },
        import.meta.env.VITE_APP_EMAILJS_PUBLIC_KEY,
      )
      .then(
        () => {
          setLoading(false);
          showAlert({
            show: true,
            text: 'Thank you for your message 😃',
            type: 'success',
          });

          setTimeout(() => {
            hideAlert(false);
            setForm({
              name: '',
              email: '',
              message: '',
            });
          }, [3000]);
        },
        (error) => {
          setLoading(false);
          console.error(error);

          showAlert({
            show: true,
            text: "I didn't receive your message 😢",
            type: 'danger',
          });
        },
      );
  };

  return (
    <section className="c-space my-20" id="contact">
      {alert.show && <Alert {...alert} />}

      <div className="relative min-h-screen flex items-center justify-center flex-col">
        <img src="/assets/terminal.png" alt="" aria-hidden="true" className="absolute inset-0 min-h-screen" />

        <div className="pt-8 contact-container">
          <h3 className="head-text">Let's talk</h3>
          <p className="text-lg text-white-600 mt-3">
          I’m currently a Member of Technical Staff at Rivo, and I love connecting with people building ambitious things. Whether it’s a collaboration, an AI/agent problem worth solving, a hackathon, or just a great conversation about full-stack and AI engineering — feel free to reach out. I read every message.
          </p>

          <a
            href="/assets/anirudh-vasudevan-resume.pdf"
            download
            className="inline-flex items-center gap-2 mt-5 px-5 py-2.5 rounded-lg bg-gradient-to-r from-blue-500 to-purple-500 text-white font-medium hover:from-blue-600 hover:to-purple-600 transition-all focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            📄 Download Résumé
          </a>

          <form ref={formRef} onSubmit={handleSubmit} className="mt-6 flex flex-col space-y-7">
            <label className="space-y-2">
              <span className="field-label">Full Name</span>
              <input
                type="text"
                name="name"
                value={form.name}
                onChange={handleChange}
                required
                className="field-input"
                placeholder="ex., John Doe"
              />
            </label>

            <label className="space-y-2">
              <span className="field-label">Email address</span>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                required
                className="field-input"
                placeholder="ex., johndoe@gmail.com"
              />
            </label>

            <label className="space-y-2">
              <span className="field-label">Your message</span>
              <textarea
                name="message"
                value={form.message}
                onChange={handleChange}
                required
                rows={5}
                className="field-input"
                placeholder="Share your thoughts or inquiries..."
              />
            </label>

            <button className="field-btn" type="submit" disabled={loading}>
              {loading ? 'Sending...' : 'Send Message'}

              <img src="/assets/arrow-up.png" alt="arrow-up" className="field-btn_arrow" />
            </button>
          </form>
        </div>
      </div>
    </section>
  );
};

export default Contact;