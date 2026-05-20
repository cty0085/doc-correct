from flask import Flask, request, jsonify
import pycorrector

app = Flask(__name__)

# 文本纠错接口（返回你要的格式）
@app.route('/correct', methods=['POST'])
def correct_text():
    data = request.get_json()
    if not data or 'text' not in data:
        return jsonify({"code": 1, "msg": "请传入 text 参数"}), 400

    text = data['text']
    corrected_sent, details = pycorrector.correct(text)

    # 组装成你需要的格式：errorWord, correctWord, position
    errors = []
    for idx, err, cor, _ in details:
        errors.append({
            "errorWord": err,
            "correctWord": cor,
            "position": idx
        })

    return jsonify({
        "code": 0,
        "original": text,
        "corrected": corrected_sent,
        "errors": errors  # 这里就是你要的格式数组
    })

# 首页
@app.route('/')
def index():
    return "文本纠错服务已启动！请用 POST 请求 /correct 接口"

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5008, debug=False)