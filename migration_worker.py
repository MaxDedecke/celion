import os
import pika
import time
import json

def get_rabbitmq_connection():
    """Establishes a connection to RabbitMQ, retrying if necessary."""
    rabbitmq_host = os.getenv("RABBITMQ_HOST", "localhost")
    rabbitmq_user = os.getenv("RABBITMQ_DEFAULT_USER", "guest")
    rabbitmq_pass = os.getenv("RABBITMQ_DEFAULT_PASS", "guest")
    credentials = pika.PlainCredentials(rabbitmq_user, rabbitmq_pass)
    connection_attempts = 10
    for i in range(connection_attempts):
        try:
            connection = pika.BlockingConnection(pika.ConnectionParameters(host=rabbitmq_host, credentials=credentials))
            print("Successfully connected to RabbitMQ.")
            return connection
        except pika.exceptions.AMQPConnectionError as e:
            print(f"Failed to connect to RabbitMQ (attempt {i+1}/{connection_attempts}): {e}")
            if i < connection_attempts - 1:
                time.sleep(5)
            else:
                raise

def callback(ch, method, properties, body):
    """Callback function to process messages from the queue."""
    print(f" [x] Received message: {body.decode()}")
    
    try:
        # Simulate processing the migration step
        task_data = json.loads(body)
        print(f" [x] Processing migration step for migration_id: {task_data.get('migration_id')}")
        # In a real scenario, you would have your migration logic here.
        # For example: process_migration_step(task_data)
        time.sleep(2) # Simulate work
        print(" [x] Done")
        
        # Acknowledge the message
        ch.basic_ack(delivery_tag=method.delivery_tag)
    except Exception as e:
        print(f" [!] Error processing message: {e}")
        # In a real scenario, you might want to reject the message and potentially requeue it
        # or send it to a dead-letter queue.
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)


def main():
    """Main function to start the worker."""
    print("Starting migration worker...")
    connection = get_rabbitmq_connection()
    channel = connection.channel()

    # Declare a durable queue
    queue_name = 'migration_tasks'
    channel.queue_declare(queue=queue_name, durable=True)

    print(f" [*] Waiting for messages in queue '{queue_name}'. To exit press CTRL+C")
    
    # Set up the consumer
    channel.basic_consume(queue=queue_name, on_message_callback=callback)

    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        print("Stopping consumer.")
        channel.stop_consuming()
    finally:
        connection.close()
        print("RabbitMQ connection closed.")


if __name__ == '__main__':
    main()
